import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { indexes, passerRating, seasonTotals, weekTitle } from "@/lib/league/derive";
import { avg, heightText, money, onColor, pct } from "@/lib/league/format";
import { DevTag, NoData, TeamBadge } from "@/components/league/bits";
import { DEV_LABEL, type StatLine } from "@/lib/league/types";
import { projectPlayer } from "@/lib/league/projection";

type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const p = (await getLeagueData(slug))?.players.find((x) => x.id === Number(id));
  return { title: p ? `${p.first} ${p.last}` : "Player" };
}

export default async function PlayerPage({ params }: Props) {
  const { slug, id } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { players, teams, games } = indexes(d);
  const p = players.get(Number(id));
  if (!p) notFound();
  const team = teams.get(p.team);
  const t = seasonTotals(d, (l) => l.p === p.id).get(p.id);
  const log = d.lines.filter((l) => l.p === p.id).map((l) => ({ l, g: games.get(l.g)! })).filter((x) => x.g)
    .sort((a, b) => a.g.stage - b.g.stage || a.g.week - b.g.week);
  const c = p.contract;
  const bg = team?.primary || "#0f3d2e";

  return (
    <main className="league-page">
      <div className="team-banner" style={{ background: bg, color: onColor(bg), borderBottomColor: team?.secondary || "#f2c200" }}>
        <div className="wrap">
          <div className="tb-row">
            <div className="jersey-big">{p.jersey}</div>
            <div>
              <h2>{p.first} {p.last}</h2>
              <div className="tb-meta">
                <span>{p.pos}</span><span>{p.ovr} OVR</span><span>{DEV_LABEL[p.dev]}</span><span>Age {p.age}</span>
                <span>{heightText(p.height)}, {p.weight} lb</span>
                {p.college && <span>{p.college}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="wrap page-tight">
        <p>
          {p.gone ? "No longer in the league." : team ? <Link className="team-link" href={`/l/${slug}/teams/${team.abbr.toLowerCase()}`}><TeamBadge team={team} size={22} />{team.city} {team.name}</Link> : "Free agent"}
          {p.ps && <span className="tag">Practice squad</span>} {p.injury > 0 && <span className="tag inj">Injured, {p.injury} wk</span>} <DevTag dev={p.dev} />
        </p>

        {!p.gone && (
          <div className="stat-tiles">
            <div className="tile"><div className="tile-label">Cap hit this season</div><div className="tile-value">{money(c.capHit)}</div></div>
            <div className="tile"><div className="tile-label">Contract</div><div className="tile-value">{money(c.salary + c.bonus)}</div><div className="tile-sub">{c.length} yrs, {c.yearsLeft} left</div></div>
            <div className="tile"><div className="tile-label">Signing bonus</div><div className="tile-value">{money(c.bonus)}</div></div>
            <div className="tile"><div className="tile-label">If cut today</div><div className="tile-value">{money(c.releaseSavings)}</div><div className="tile-sub">saved, {money(c.releasePenalty)} dead</div></div>
          </div>
        )}

        {!p.gone && c.yearsLeft > 0 && (() => {
          const hits = projectPlayer(p, d.season.year).hits;
          const ys = Object.keys(hits).map(Number).sort((a, b) => a - b);
          return (
            <div className="panel tbl-wrap">
              <table className="tbl">
                <caption>Cap hit by year <span className="muted">later years projected</span></caption>
                <thead><tr>{ys.map((y, i) => <th key={y} className="num">{y}{i > 0 && <span className="proj">proj.</span>}</th>)}</tr></thead>
                <tbody><tr>{ys.map((y, i) => <td key={y} className={`num ${i === 0 ? "strong" : ""}`}>{money(hits[y])}</td>)}</tr></tbody>
              </table>
            </div>
          );
        })()}

        {p.abilities.length > 0 && (
          <div className="panel">
            <h3>Abilities</h3>
            <ul className="abilities">{p.abilities.map((a) => <li key={a.title}><span className={`tier tier-${a.tier.toLowerCase()}`}>{a.tier}</span> {a.title}</li>)}</ul>
          </div>
        )}

        {t && (
          <div className="panel tbl-wrap">
            <table className="tbl">
              <caption>Regular season</caption>
              <thead><tr><th className="num">GP</th>{t.pa > 0 && <><th className="num">PASS</th><th className="num">TD-INT</th><th className="num">RTG</th></>}{t.ra > 0 && <><th className="num">RUSH</th><th className="num">AVG</th></>}{t.rc > 0 && <><th className="num">REC</th><th className="num">YDS</th></>}{(t.tk + t.sk) > 0 && <><th className="num">TKL</th><th className="num">SCK</th><th className="num">INT</th></>}{t.fga > 0 && <th className="num">FG</th>}</tr></thead>
              <tbody><tr>
                <td className="num">{t.gp}</td>
                {t.pa > 0 && <><td className="num">{t.pc}/{t.pa}, {t.py} yds ({pct(t.pc, t.pa)}%)</td><td className="num">{t.ptd}-{t.pint}</td><td className="num">{passerRating(t).toFixed(1)}</td></>}
                {t.ra > 0 && <><td className="num">{t.ra} for {t.ry}, {t.rtd} TD</td><td className="num">{avg(t.ry, t.ra)}</td></>}
                {t.rc > 0 && <><td className="num">{t.rc}</td><td className="num">{t.rcy}, {t.rctd} TD</td></>}
                {(t.tk + t.sk) > 0 && <><td className="num">{t.tk}</td><td className="num">{t.sk}</td><td className="num">{t.int}</td></>}
                {t.fga > 0 && <td className="num">{t.fgm}/{t.fga}</td>}
              </tr></tbody>
            </table>
          </div>
        )}

        {log.length > 0 && (
          <div className="panel tbl-wrap">
            <table className="tbl">
              <caption>Game log</caption>
              <thead><tr><th>Week</th><th>Opp</th><th>Line</th></tr></thead>
              <tbody>
                {log.map(({ l, g }) => {
                  const home = g.home === l.t;
                  const opp = teams.get(home ? g.away : g.home);
                  return (
                    <tr key={l.g}>
                      <td className="muted nw">{weekTitle(d, g.stage, g.week)}</td>
                      <td className="nw">{home ? "vs" : "at"} {opp?.abbr ?? "TBD"}</td>
                      <td><Link href={`/l/${slug}/games/${g.id}`}>{lineText(l)}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function lineText(l: StatLine) {
  const parts: string[] = [];
  const n = (x?: number) => x || 0;
  if (n(l.pa)) parts.push(`${n(l.pc)}/${n(l.pa)}, ${n(l.py)} yds, ${n(l.ptd)} TD, ${n(l.pint)} INT`);
  if (n(l.ra)) parts.push(`${n(l.ra)} car, ${n(l.ry)} yds${n(l.rtd) ? `, ${l.rtd} TD` : ""}`);
  if (n(l.rc)) parts.push(`${n(l.rc)} rec, ${n(l.rcy)} yds${n(l.rctd) ? `, ${l.rctd} TD` : ""}`);
  if (n(l.tk) || n(l.sk) || n(l.int)) parts.push(`${n(l.tk)} tkl${n(l.sk) ? `, ${l.sk} sck` : ""}${n(l.int) ? `, ${l.int} INT` : ""}`);
  if (n(l.fga) || n(l.xpa)) parts.push(`FG ${n(l.fgm)}/${n(l.fga)}, XP ${n(l.xpm)}/${n(l.xpa)}`);
  if (n(l.pnt)) parts.push(`${l.pnt} punts, ${avg(n(l.pnty), n(l.pnt))} avg`);
  return parts.join("; ") || "Played";
}
