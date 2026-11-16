"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money, onColor } from "@/lib/league/format";

/** Everything by season from this one (index 0) on. */
export type TradePlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; dev: number; ps: boolean;
  yl: number;        // years left
  hits: number[];    // cap hit by season
  bonus: number[];   // the bonus part of each season's cap hit (stays with the old team)
  dead: number[];    // void-year bonus still counting after his deal ends
  pen: number;       // dead money if he leaves now (Madden's own number)
};
export type TradeTeam = { id: number; abbr: string; name: string; primary: string; active: number; committed: number[]; cap: number[] };
type Pick = { y: number; r: number };
type Side = { team: number | null; players: number[]; picks: Pick[] };

const DEV = ["Normal", "Star", "Superstar", "X-Factor"];
const ROUND = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

export function TradeTool({ slug, year, draftYears, years, capSet, players, teams, initial }: {
  slug: string; year: number; draftYears: number[]; years: number[]; capSet: boolean[]; players: TradePlayer[]; teams: TradeTeam[];
  initial: { a: number | null; b: number | null; pa: number[]; pb: number[]; ka: Pick[]; kb: Pick[] };
}) {
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const keep = (team: number | null, ids: number[]) => ids.filter((id) => playerById.get(id)?.t === team);
  const [a, setA] = useState<Side>({ team: initial.a, players: keep(initial.a, initial.pa), picks: initial.ka });
  const [b, setB] = useState<Side>({ team: initial.b, players: keep(initial.b, initial.pb), picks: initial.kb });

  // Keep the address shareable.
  useEffect(() => {
    const q = new URLSearchParams();
    const ta = a.team ? teamById.get(a.team) : null, tb = b.team ? teamById.get(b.team) : null;
    if (ta) q.set("a", ta.abbr);
    if (tb) q.set("b", tb.abbr);
    if (a.players.length) q.set("pa", a.players.join(","));
    if (b.players.length) q.set("pb", b.players.join(","));
    if (a.picks.length) q.set("ka", a.picks.map((k) => `${k.y}-${k.r}`).join(","));
    if (b.picks.length) q.set("kb", b.picks.map((k) => `${k.y}-${k.r}`).join(","));
    const s = q.toString();
    window.history.replaceState(null, "", `/l/${slug}/trades${s ? `?${s}` : ""}`);
  }, [a, b, slug, teamById]);

  const ready = a.team && b.team && a.team !== b.team;
  const anything = a.players.length + b.players.length + a.picks.length + b.picks.length > 0;
  const swap = () => { setA(b); setB(a); };
  const reset = () => { setA({ team: a.team, players: [], picks: [] }); setB({ team: b.team, players: [], picks: [] }); };

  return (
    <>
      <div className="trade-sides">
        <SidePicker label="Team 1" side={a} setSide={setA} other={b.team} teams={teams} players={players} playerById={playerById} draftYears={draftYears} />
        <div className="trade-swap">
          <button type="button" className="btn btn-quiet trade-swap-btn" onClick={swap} aria-label="Swap sides" title="Swap sides">⇄</button>
        </div>
        <SidePicker label="Team 2" side={b} setSide={setB} other={a.team} teams={teams} players={players} playerById={playerById} draftYears={draftYears} />
      </div>

      {!ready ? (
        <p className="muted">Pick a team on each side to start.</p>
      ) : !anything ? (
        <p className="muted">Add players or picks on either side to see what the trade does to each team&apos;s cap.</p>
      ) : (
        <>
          <div className="section-head trade-results-head">
            <h3>What the trade does to each cap</h3>
            <button type="button" className="btn-link" onClick={reset}>Clear assets</button>
          </div>
          <div className="trade-results">
            <Impact team={teamById.get(a.team!)!} other={teamById.get(b.team!)!} sends={a} gets={b} playerById={playerById} years={years} capSet={capSet} slug={slug} />
            <Impact team={teamById.get(b.team!)!} other={teamById.get(a.team!)!} sends={b} gets={a} playerById={playerById} years={years} capSet={capSet} slug={slug} />
          </div>
          <p className="hint">
            How Madden handles a trade: the team trading a player away takes all of his bonus that hasn&apos;t been charged yet as dead money
            this season (Madden&apos;s own &quot;dead if released&quot; number) and owes nothing on him after that. The team getting him pays only
            his salary; his bonus stays behind. {year} starts from each team&apos;s real cap numbers. Later years add up current contracts against
            a league cap that grows $15M a year, so they&apos;re projections. Madden won&apos;t accept a trade that puts either team over the cap this season.
          </p>
        </>
      )}
    </>
  );
}

function SidePicker({ label, side, setSide, other, teams, players, playerById, draftYears }: {
  label: string; side: Side; setSide: (s: Side) => void; other: number | null; teams: TradeTeam[];
  players: TradePlayer[]; playerById: Map<number, TradePlayer>; draftYears: number[];
}) {
  const [q, setQ] = useState("");
  const team = teams.find((t) => t.id === side.team);
  const roster = useMemo(() => {
    if (!side.team) return [];
    const s = q.trim().toLowerCase();
    return players
      .filter((p) => p.t === side.team && (!s || p.n.toLowerCase().includes(s) || p.pos.toLowerCase() === s))
      .sort((x, y) => y.hits[0] - x.hits[0] || y.ovr - x.ovr);
  }, [players, side.team, q]);
  const toggle = (id: number) =>
    setSide({ ...side, players: side.players.includes(id) ? side.players.filter((x) => x !== id) : [...side.players, id] });
  const [pickYear, setPickYear] = useState(draftYears[0]);
  const [pickRound, setPickRound] = useState(1);
  const addPick = () => {
    if (side.picks.some((k) => k.y === pickYear && k.r === pickRound)) return;
    setSide({ ...side, picks: [...side.picks, { y: pickYear, r: pickRound }].sort((x, y) => x.y - y.y || x.r - y.r) });
  };

  return (
    <section className="panel trade-side" style={team ? { borderTop: `4px solid ${team.primary}` } : undefined}>
      <label className="trade-team-select">
        <span className="small muted">{label} sends</span>
        <select value={side.team ?? ""} onChange={(e) => { setQ(""); setSide({ team: Number(e.target.value) || null, players: [], picks: [] }); }}>
          <option value="">Choose a team</option>
          {teams.map((t) => <option key={t.id} value={t.id} disabled={t.id === other}>{t.name}</option>)}
        </select>
      </label>

      {team && (
        <>
          {(side.players.length > 0 || side.picks.length > 0) && (
            <ul className="trade-chips" aria-label={`${team.abbr} sends`}>
              {side.players.map((id) => {
                const p = playerById.get(id);
                if (!p) return null;
                return (
                  <li key={id}>
                    <span><strong>{p.n}</strong> <span className="muted small">{p.pos} {p.ovr}</span></span>
                    <button type="button" aria-label={`Remove ${p.n}`} onClick={() => toggle(id)}>×</button>
                  </li>
                );
              })}
              {side.picks.map((k) => (
                <li key={`${k.y}-${k.r}`}>
                  <span><strong>{k.y} {ROUND[k.r]} round pick</strong></span>
                  <button type="button" aria-label="Remove pick" onClick={() => setSide({ ...side, picks: side.picks.filter((x) => x !== k) })}>×</button>
                </li>
              ))}
            </ul>
          )}

          <input type="search" className="trade-filter" placeholder="Filter by name or position" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${team.abbr} roster`} />
          <div className="trade-roster" role="group" aria-label={`${team.abbr} roster`}>
            {roster.length === 0 && <p className="muted small" style={{ padding: "8px 10px" }}>No players match.</p>}
            {roster.map((p) => {
              const on = side.players.includes(p.id);
              return (
                <label key={p.id} className={`trade-row ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                  <span className="tr-name">
                    {p.n}
                    <span className="muted small"> {p.pos}, {p.ovr} OVR, age {p.age}{p.dev ? `, ${DEV[p.dev]}` : ""}{p.ps ? ", PS" : ""}</span>
                  </span>
                  <span className="tr-money num">
                    {money(p.hits[0])}
                    <span className="muted small">{p.yl > 0 ? `${p.yl} yr${p.yl === 1 ? "" : "s"} left` : "no deal"}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="trade-pick-add">
            <span className="small muted">Draft pick</span>
            <select value={pickYear} onChange={(e) => setPickYear(Number(e.target.value))} aria-label="Pick year">
              {draftYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={pickRound} onChange={(e) => setPickRound(Number(e.target.value))} aria-label="Pick round">
              {[1, 2, 3, 4, 5, 6, 7].map((r) => <option key={r} value={r}>{ROUND[r]} round</option>)}
            </select>
            <button type="button" className="btn btn-quiet trade-pick-btn" onClick={addPick}>Add</button>
          </div>
        </>
      )}
    </section>
  );
}

function Impact({ team, other, sends, gets, playerById, years, capSet, slug }: {
  team: TradeTeam; other: TradeTeam; sends: Side; gets: Side; playerById: Map<number, TradePlayer>; years: number[]; capSet: boolean[]; slug: string;
}) {
  const out = sends.players.map((id) => playerById.get(id)!).filter(Boolean);
  const inc = gets.players.map((id) => playerById.get(id)!).filter(Boolean);
  const rows = years.map((y, i) => {
    // Leaving: this season his whole cap hit comes off (then the penalty goes on);
    // later seasons, his cap hit and any void-year bonus (practice squad deals aren't counted there).
    const leaving = out.reduce((s, p) => s + (i === 0 ? p.hits[0] : p.ps ? 0 : p.hits[i] + p.dead[i]), 0);
    const dead = i === 0 ? out.reduce((s, p) => s + p.pen, 0) : 0;
    const arriving = inc.reduce((s, p) => s + Math.max(0, p.hits[i] - p.bonus[i]), 0);
    const before = team.cap[i] - team.committed[i];
    const change = leaving - dead - arriving;
    return { y: years[i], i, before, leaving, dead, arriving, change, after: before + change };
  });
  const now = rows[0];
  const activeOut = out.filter((p) => !p.ps).length;
  const rosterAfter = team.active - activeOut + inc.length;
  const over = now.after < 0;
  const deadTotal = now.dead;

  return (
    <section className="panel trade-impact" style={{ borderTop: `4px solid ${team.primary}` }}>
      <div className="player-head">
        <div>
          <h3 style={{ margin: 0 }}>{team.name}</h3>
          <div className="muted small">
            Sends {describe(out, sends.picks)} · Gets {describe(inc, gets.picks)}
          </div>
        </div>
        <span className="team-pill" style={{ background: team.primary, color: onColor(team.primary) }}>{team.abbr}</span>
      </div>

      <div className="stat-tiles">
        <div className="tile">
          <div className="tile-label">{now.y} cap space after</div>
          <div className={`tile-value ${over ? "neg" : ""}`}>{money(now.after)}</div>
          <div className="tile-sub">{money(now.change, { sign: true })} from {money(now.before)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">New dead money</div>
          <div className="tile-value">{money(deadTotal)}</div>
          <div className="tile-sub">all in {now.y}</div>
        </div>
        <div className="tile">
          <div className="tile-label">{rows[1]?.y ?? now.y} space after</div>
          <div className={`tile-value ${rows[1] && rows[1].after < 0 ? "neg" : ""}`}>{rows[1] ? money(rows[1].after) : "—"}</div>
          <div className="tile-sub">{rows[1] ? `${money(rows[1].change, { sign: true })}, proj.` : ""}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Active roster</div>
          <div className="tile-value">{rosterAfter}</div>
          <div className="tile-sub">was {team.active}{rosterAfter !== 53 ? `, ${rosterAfter > 53 ? "over" : "under"} 53` : ""}</div>
        </div>
      </div>
      {over && <p className="notice error">This puts the {team.name} {money(-now.after)} over the {now.y} cap. Madden won&apos;t accept the trade as it stands.</p>}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Year</th><th className="num">Space before</th><th className="num">Players out</th>
              <th className="num">New dead money</th><th className="num">Players in</th><th className="num">Space after</th><th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.y}>
                <td>{r.y}{r.i > 0 && !capSet[r.i] && <span className="proj">proj.</span>}</td>
                <td className="num muted">{money(r.before)}</td>
                <td className="num">{r.leaving ? `−${money(r.leaving)}` : "—"}</td>
                <td className="num">{r.dead ? `+${money(r.dead)}` : "—"}</td>
                <td className="num">{r.arriving ? `+${money(r.arriving)}` : "—"}</td>
                <td className={`num strong ${r.after < 0 ? "neg" : ""}`}>{money(r.after)}</td>
                <td className={`num ${r.change > 0 ? "pos" : r.change < 0 ? "neg" : "muted"}`}>{r.change ? money(r.change, { sign: true }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(out.length > 0 || inc.length > 0) && (
        <details className="trade-detail">
          <summary>Player by player</summary>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Player</th><th></th>{years.map((y) => <th key={y} className="num">{y}</th>)}</tr>
              </thead>
              <tbody>
                {out.map((p) => (
                  <tr key={`o${p.id}`}>
                    <td><Link href={`/l/${slug}/players/${p.id}`}>{p.n}</Link> <span className="muted small">{p.pos}</span></td>
                    <td className="small muted">to {other.abbr}</td>
                    {years.map((y, i) => {
                      const v = i === 0 ? p.pen - p.hits[0] : p.ps ? 0 : -(p.hits[i] + p.dead[i]);
                      return <td key={y} className={`num ${v < 0 ? "pos" : v > 0 ? "neg" : "muted"}`}>{v ? money(-v, { sign: true }) : "—"}</td>;
                    })}
                  </tr>
                ))}
                {inc.map((p) => (
                  <tr key={`i${p.id}`}>
                    <td><Link href={`/l/${slug}/players/${p.id}`}>{p.n}</Link> <span className="muted small">{p.pos}</span></td>
                    <td className="small muted">from {other.abbr}</td>
                    {years.map((y, i) => {
                      const v = Math.max(0, p.hits[i] - p.bonus[i]);
                      return <td key={y} className={`num ${v ? "neg" : "muted"}`}>{v ? money(-v, { sign: true }) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Cap space each player adds (+) or takes (−) for the {team.name}. For a player leaving, {years[0]} is his cap hit coming off minus the dead money
            going on. For a player arriving, it&apos;s his salary only; his bonus stays with {other.abbr}.
          </p>
        </details>
      )}
    </section>
  );
}


function describe(ps: TradePlayer[], picks: Pick[]) {
  const parts = [...ps.map((p) => p.n), ...picks.map((k) => `${k.y} ${ROUND[k.r]}`)];
  return parts.length ? parts.join(", ") : "nothing";
}
