import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { indexes, passerRating, seasonTotals, weekTitle } from "@/lib/league/derive";
import { avg, heightText, money, onColor, pct } from "@/lib/league/format";
import { DevTag, NoData, TeamBadge } from "@/components/league/bits";
import { DEV_LABEL, type LeagueData, type Player, type StatLine } from "@/lib/league/types";
import { ratingGroups } from "@/lib/league/ratingGroups";
import { leagueCap, projectedLeagueCap } from "@/lib/league/cap";
import { projectPlayer } from "@/lib/league/projection";
import { eligibleAbilities, findAbility } from "@/lib/league/abilities";
import { AbilityMechanics, EligibleRow, TierPill } from "@/components/league/AbilityInfo";
import { PlayerCard } from "@/components/league/PlayerCard";
import { cardBackProps, cardProps } from "@/lib/league/cardProps";
import { leagueMemberId, signedCardArt } from "@/lib/cardArtStore";
import { CardArtEditor } from "@/components/league/CardArtEditor";
import { headshotUrl } from "@/lib/league/headshots";
import { CountUp } from "@/components/league/CountUp";

type Props = { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ tab?: string }> };
const TABS = [["ratings", "Ratings"], ["abilities", "Abilities"], ["log", "Game log"], ["contract", "Contract"]] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const p = (await getLeagueData(slug))?.players.find((x) => x.id === Number(id));
  return { title: p ? `${p.first} ${p.last}` : "Player" };
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const { slug, id } = await params;
  const tabParam = (await searchParams)?.tab;
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam! : "ratings";
  const base = `/l/${slug}/players/${id}`;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { players, teams } = indexes(d);
  const p = players.get(Number(id));
  if (!p) notFound();
  const team = teams.get(p.team);
  const bg = team?.primary || "#1b2340";
  // Card art is members-only (photos of real players aren't ours to publish): an uploaded
  // photo if there is one, else the player's NFL.com headshot as a stand-in.
  const member = Boolean(await leagueMemberId(slug).catch(() => null));
  const uploaded = member ? await signedCardArt(slug, p.id) : undefined;
  const art = uploaded ?? (member ? headshotUrl(p) : undefined);

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

        <div className="player-hero">
          <div className="pcard-col">
          <PlayerCard {...cardProps(d, slug, p, team, art)} {...cardBackProps(d, p)} />
          {member && <CardArtEditor slug={slug} playerId={p.id} hasArt={Boolean(uploaded)} />}
          </div>
          <div className="player-tabs">
            <nav className="tabs" aria-label="Player">
              {TABS.map(([k, label]) => (
                <Link key={k} href={k === "ratings" ? base : `${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} scroll={false}>{label}</Link>
              ))}
            </nav>
            {tab === "abilities" ? (p.gone ? <p className="muted">No longer in the league.</p> : <AbilitiesPanel slug={slug} p={p} />)
              : tab === "log" ? <GameLogTab d={d} p={p} slug={slug} />
              : tab === "contract" ? <ContractTab d={d} p={p} slug={slug} />
              : <RatingsTab p={p} />}
          </div>
        </div>
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

function AbilitiesPanel({ slug, p }: { slug: string; p: import("@/lib/league/types").Player }) {
  const eligible = p.ratings && p.slots ? eligibleAbilities(p) : null;
  const fresh = eligible?.filter((e) => !e.has) || [];
  if (!p.abilities.length && !fresh.length) return <p className="muted">No abilities yet, and none he qualifies for.</p>;
  const groups: [string, typeof fresh][] = [
    ["X-Factor", fresh.filter((e) => e.tier === "Single")],
    ["Gold", fresh.filter((e) => e.tier === "Gold")],
    ["Silver", fresh.filter((e) => e.tier === "Silver")],
    ["Bronze", fresh.filter((e) => e.tier === "Bronze")],
  ];
  return (
    <div className="panel">
      <h3>Abilities</h3>
      {p.abilities.length > 0 && (
        <div className="ab-list">
          {p.abilities.map((h) => {
            const a = findAbility(h.title);
            const el = eligible?.find((e) => e.ability.key === a?.key);
            return (
              <details className="ab-row" key={h.title}>
                <summary>
                  <TierPill tier={h.tier} />
                  {a ? <Link href={`/l/${slug}/abilities/${a.key}`} className="ab-name">{h.title}</Link> : <span className="ab-name">{h.title}</span>}
                  {el?.next && el.tier !== "Single" && (
                    <span className="ab-next small muted">{el.next.tier} needs {el.next.missing.map((m) => `${m.label}${m.min ? ` ${m.min}` : ""}${m.have != null ? ` (has ${m.have})` : ""}`).join(", ")}</span>
                  )}
                </summary>
                {a ? <AbilityMechanics a={a} slug={slug} /> : <p className="muted small">No mechanics on file for this one.</p>}
              </details>
            );
          })}
        </div>
      )}
      {eligible == null ? (
        <p className="hint">Eligible abilities show up after this league&apos;s next sync.</p>
      ) : fresh.length > 0 && (
        <>
          <h4 className="ab-h">Eligible for <span className="muted small">{fresh.length} he meets every requirement for, at the best tier he qualifies for</span></h4>
          {groups.filter(([, l]) => l.length).map(([name, list]) => (
            <div key={name} className="ab-group">
              <div className="ab-group__h">{name}</div>
              <div className="ab-list">{list.map((e) => <EligibleRow key={e.ability.key} e={e} slug={slug} />)}</div>
            </div>
          ))}
          <p className="hint">
            Requirements are Madden 27 franchise rules (position, open ability slot, ratings) from Madden School. Some abilities also need an
            archetype rating such as Speed Rusher, which EA doesn&apos;t send; those are estimated from his ratings, and &quot;close call&quot; marks
            ones within a point of the cutoff. What each ability does comes from Madden&apos;s own trigger and effect names (via ClutchTrait).
          </p>
        </>
      )}
    </div>
  );
}


function RatingsTab({ p }: { p: Player }) {
  const groups = ratingGroups(p);
  if (!groups.length) return <p className="hint">Ratings show up after this league&apos;s next sync.</p>;
  return (
    <div className="rt-groups">
      {groups.map((g) => (
        <section key={g.name} className="panel rt-group">
          <h3>{g.name}</h3>
          {g.rows.map((r) => (
            <div key={r.key} className={`rt-row ${r.value >= 90 ? "hi" : r.value >= 80 ? "good" : r.value < 60 ? "low" : ""}`}>
              <span className="rt-label">{r.label}</span>
              <span className="rt-bar"><span style={{ width: `${Math.max(2, Math.min(100, r.value))}%` }} /></span>
              <b className="rt-val">{r.value}</b>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function GameLogTab({ d, p, slug }: { d: LeagueData; p: Player; slug: string }) {
  const { teams, games } = indexes(d);
  const t = seasonTotals(d, (l) => l.p === p.id).get(p.id);
  const log = d.lines.filter((l) => l.p === p.id).map((l) => ({ l, g: games.get(l.g)! })).filter((x) => x.g)
    .sort((a, b) => a.g.stage - b.g.stage || a.g.week - b.g.week);
  if (!t && !log.length) return <p className="muted">No games logged this season.</p>;
  return (
    <>
      {t && (
        <div className="panel tbl-wrap">
          <table className="tbl">
            <caption>{d.season.year} regular season</caption>
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
    </>
  );
}

function ContractTab({ d, p, slug }: { d: LeagueData; p: Player; slug: string }) {
  const c = p.contract;
  if (p.gone) return <p className="muted">No longer in the league.</p>;
  const total = c.salary + c.bonus;
  const pr = projectPlayer(p, d.season.year);
  const ys = Object.keys(pr.hits).map(Number).sort((a, b) => a - b);
  const deadYs = Object.keys(pr.dead).map(Number).filter((y) => !ys.includes(y)).sort((a, b) => a - b);
  const signed = p.team && c.length > 0;
  return (
    <>
      {signed ? (
        <div className="stat-tiles">
          <div className="tile"><div className="tile-label">Cap hit this season</div><div className="tile-value"><CountUp value={c.capHit} /></div></div>
          <div className="tile"><div className="tile-label">Contract</div><div className="tile-value"><CountUp value={total} /></div><div className="tile-sub">{c.length} yrs, {c.yearsLeft} left</div></div>
          <div className="tile"><div className="tile-label">Per year</div><div className="tile-value"><CountUp value={Math.round(total / c.length)} /></div><div className="tile-sub">{money(c.salary)} salary, {money(c.bonus)} bonus</div></div>
          <div className="tile"><div className="tile-label">If cut today</div><div className="tile-value"><CountUp value={c.releaseSavings} /></div><div className="tile-sub">saved, {money(c.releasePenalty)} dead</div></div>
        </div>
      ) : <p className="muted">{p.team ? "No contract on file." : "Free agent."}</p>}

      {signed && ys.length > 0 && (
        <div className="panel tbl-wrap">
          <table className="tbl">
            <caption>Cap hit by year <span className="muted">{pr.source === "formula" ? "later years projected from his deal" : "follows his real NFL contract"}</span></caption>
            <thead><tr><th>Season</th><th className="num">Cap hit</th><th className="num">Share of the cap</th></tr></thead>
            <tbody>
              {ys.map((y, i) => {
                const cap = projectedLeagueCap(leagueCap(d.teams), d.season.year, y);
                return (
                  <tr key={y}>
                    <td className="nw">{y}{i > 0 && <span className="muted small"> proj.</span>}</td>
                    <td className={`num ${i === 0 ? "strong" : ""}`}>{money(pr.hits[y])}</td>
                    <td className="num muted">{pct(pr.hits[y], cap)}%</td>
                  </tr>
                );
              })}
              {deadYs.map((y) => (
                <tr key={y}><td className="nw">{y} <span className="muted small">void year</span></td><td className="num">{money(pr.dead[y])}</td><td className="num muted">dead money</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.desired && p.desired.length > 0 && p.desired.salary + p.desired.bonus > 0 && (
        <div className="panel">
          <h3>Madden&apos;s in-game ask</h3>
          <p>{p.desired.length} yrs, {money(p.desired.salary + p.desired.bonus)} ({money(p.desired.bonus)} bonus)</p>
        </div>
      )}
      <p><Link className="btn" href={`/l/${slug}/contracts?player=${p.id}`}>Open in the contract tool</Link> <span className="muted small">recommended deal, offer builder and cap effect</span></p>
    </>
  );
}
