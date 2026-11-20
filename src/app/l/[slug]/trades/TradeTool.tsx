"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money, onColor } from "@/lib/league/format";
import { capRows, deadSplit, DEV, GROUP_NAME, pickSlot, pickSpotText, ROUND, scoreTrade, type AssetScore, type Pick, type Side, type TeamScore, type TradePlayer, type TradeTeam } from "@/lib/league/tradeMath";

export type { TradePlayer, TradeTeam };

export function TradeTool({ slug, year, firstDraft, orderFinal, draftYears, years, capSet, players, teams, initial }: {
  slug: string; year: number; firstDraft: number; orderFinal: boolean; draftYears: number[]; years: number[]; capSet: boolean[]; players: TradePlayer[]; teams: TradeTeam[];
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
    if (a.picks.length) q.set("ka", a.picks.map(pickParam).join(","));
    if (b.picks.length) q.set("kb", b.picks.map(pickParam).join(","));
    const s = q.toString();
    window.history.replaceState(null, "", `/l/${slug}/trades${s ? `?${s}` : ""}`);
  }, [a, b, slug, teamById]);

  const ready = a.team && b.team && a.team !== b.team;
  const anything = a.players.length + b.players.length + a.picks.length + b.picks.length > 0;
  const swap = () => { setA(b); setB(a); };
  const score = useMemo(() => (ready && anything ? scoreTrade({ players, teams, years, firstDraft, a, b, orderFinal }) : null), [ready, anything, players, teams, years, firstDraft, a, b, orderFinal]);
  const reset = () => { setA({ team: a.team, players: [], picks: [] }); setB({ team: b.team, players: [], picks: [] }); };

  return (
    <>
      <div className="trade-sides">
        <SidePicker label="Team 1" side={a} setSide={setA} other={b.team} teams={teams} players={players} playerById={playerById} draftYears={draftYears} firstDraft={firstDraft} orderFinal={orderFinal} />
        <div className="trade-swap">
          <button type="button" className="btn btn-quiet trade-swap-btn" onClick={swap} aria-label="Swap sides" title="Swap sides">⇄</button>
        </div>
        <SidePicker label="Team 2" side={b} setSide={setB} other={a.team} teams={teams} players={players} playerById={playerById} draftYears={draftYears} firstDraft={firstDraft} orderFinal={orderFinal} />
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
          {score && <ScorePanel s={score} slug={slug} a={a} b={b} teamById={teamById} />}
          <div className="trade-results">
            <Impact team={teamById.get(a.team!)!} other={teamById.get(b.team!)!} sends={a} gets={b} playerById={playerById} years={years} capSet={capSet} slug={slug} />
            <Impact team={teamById.get(b.team!)!} other={teamById.get(a.team!)!} sends={b} gets={a} playerById={playerById} years={years} capSet={capSet} slug={slug} />
          </div>
          <p className="hint">
            How Madden handles a trade: the team trading a player away takes this season&apos;s share of his bonus as dead money now, and the rest
            of his bonus that hasn&apos;t been charged yet (what&apos;s left of Madden&apos;s &quot;dead if released&quot; number) next season. After that it owes nothing on him. The team getting him pays only
            his salary; his bonus stays behind. {year} starts from each team&apos;s real cap numbers. Later years add up current contracts against
            a league cap that grows $15M a year, so they&apos;re projections. Madden won&apos;t accept a trade that puts either team over the cap this season.
          </p>
        </>
      )}
    </>
  );
}

function SidePicker({ label, side, setSide, other, teams, players, playerById, draftYears, firstDraft, orderFinal }: {
  label: string; side: Side; setSide: (s: Side) => void; other: number | null; teams: TradeTeam[];
  players: TradePlayer[]; playerById: Map<number, TradePlayer>; draftYears: number[]; firstDraft: number; orderFinal: boolean;
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
              {side.picks.map((k) => {
                const auto = pickSlot({ y: k.y, r: k.r }, team, firstDraft).slot;
                const setSlot = (v: string) => {
                  const n = Math.round(Number(v));
                  setSide({ ...side, picks: side.picks.map((x) => (x === k ? (n >= 1 && n <= 32 && n !== auto ? { y: k.y, r: k.r, s: n } : { y: k.y, r: k.r }) : x)) });
                };
                return (
                  <li key={`${k.y}-${k.r}`} className="trade-pick-chip">
                    <span>
                      <strong>{k.y} {ROUND[k.r]} round pick</strong>
                      <span className="muted small"> {pickSpotText(k, team, firstDraft, orderFinal)}</span>
                    </span>
                    <label className="trade-pick-slot small" title="Pick number within the round. Leave it on the automatic number unless the real pick is different (e.g. a pick this team got from someone else).">
                      #
                      <input type="number" min={1} max={32} inputMode="numeric" value={k.u ? "" : k.s ?? auto} placeholder={k.u ? "?" : undefined} onChange={(e) => setSlot(e.target.value)} aria-label={`${k.y} ${ROUND[k.r]} round pick number in the round`} />
                      {k.s || k.u ? <button type="button" className="btn-link small" onClick={() => setSlot("")}>auto</button> : null}
                    </label>
                    <button type="button" aria-label="Remove pick" onClick={() => setSide({ ...side, picks: side.picks.filter((x) => x !== k) })}>×</button>
                  </li>
                );
              })}
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
                    <span className="muted small"> {p.pos}, {p.ovr} OVR · <span title="User rating: his percentile at his position on speed, size and the skills that win user games">{p.ur} UR</span>, age {p.age}{p.dev ? `, ${DEV[p.dev]}` : ""}{p.ps ? ", PS" : ""}</span>
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
  const rows = capRows(team, out, inc, years);
  const now = rows[0];
  const activeOut = out.filter((p) => !p.ps).length;
  const rosterAfter = team.active - activeOut + inc.length;
  const over = now.after < 0;
  const deadTotal = now.dead + (rows[1]?.dead || 0);

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
          <div className="tile-sub">{money(now.dead)} in {now.y}{rows[1]?.dead ? `, ${money(rows[1].dead)} in ${rows[1].y}` : ""}</div>
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
                      const v = (i <= 1 ? deadSplit(p)[i] : 0) - (i === 0 ? p.hits[0] : p.ps ? 0 : p.hits[i] + p.dead[i]);
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
            Cap space each player adds (+) or takes (−) for the {team.name}. For a player leaving, it&apos;s his cap hit coming off minus the dead money
            going on ({years[0]}: this season&apos;s bonus share; {years[1]}: the rest). For a player arriving, it&apos;s his salary only; his bonus stays with {other.abbr}.
          </p>
        </details>
      )}
    </section>
  );
}


const pickParam = (k: Pick) => `${k.y}-${k.r}${k.u ? "-u" : k.s ? `-${k.s}` : ""}`;

function describe(ps: TradePlayer[], picks: Pick[]) {
  const parts = [...ps.map((p) => p.n), ...picks.map((k) => `${k.y} ${ROUND[k.r]}`)];
  return parts.length ? parts.join(", ") : "nothing";
}

/** The trade score: who wins, each team's grade, what each asset is worth to the team getting it,
 *  and the button that posts the proposal to the league's Discord. */
function ScorePanel({ s, slug, a, b, teamById }: { s: NonNullable<ReturnType<typeof scoreTrade>>; slug: string; a: Side; b: Side; teamById: Map<number, TradeTeam> }) {
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean }>({ busy: false });
  const key = JSON.stringify([a, b]);
  useEffect(() => setState({ busy: false }), [key]); // a changed trade can be submitted again
  const ta = teamById.get(a.team!)!, tb = teamById.get(b.team!)!;
  const over = [s.a, s.b].filter((t) => t.capNow.after < 0);

  const submit = async () => {
    setState({ busy: true });
    const q = new URLSearchParams(window.location.search);
    try {
      const r = await fetch(`/api/leagues/${slug}/trade-proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q.toString() }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      setState({ busy: false, ok: r.ok, msg: r.ok ? j.message || "Posted to Discord." : j.error || `Couldn't submit (${r.status}).` });
    } catch {
      setState({ busy: false, ok: false, msg: "Couldn't reach the site. Try again." });
    }
  };

  return (
    <section className="panel trade-score">
      <div className="ts-head">
        <div>
          <span className="small muted">Trade score</span>
          <h3 style={{ margin: 0 }}>{s.verdict}</h3>
        </div>
        <div className="ts-grades">
          <span className="ts-grade" style={{ borderColor: ta.primary }}><b>{s.a.grade}</b><span className="small muted">{ta.abbr}</span></span>
          <span className="ts-grade" style={{ borderColor: tb.primary }}><b>{s.b.grade}</b><span className="small muted">{tb.abbr}</span></span>
        </div>
      </div>
      <div className="ts-bar" role="img" aria-label={`${ta.abbr} ${s.score}, ${tb.abbr} ${100 - s.score}`}>
        <span style={{ width: `${s.score}%`, background: ta.primary, color: onColor(ta.primary) }}>{ta.abbr} {s.score}</span>
        <span style={{ width: `${100 - s.score}%`, background: tb.primary, color: onColor(tb.primary) }}>{100 - s.score} {tb.abbr}</span>
      </div>
      <div className="ts-sides">
        <ScoreSide t={s.a} />
        <ScoreSide t={s.b} />
      </div>
      {over.length > 0 && <p className="notice error">{over.map((t) => t.team.abbr).join(" and ")} would be over the {s.a.capNow.y} cap, so Madden won&apos;t accept this yet. You can still post it.</p>}
      <div className="ts-submit">
        <button type="button" className="btn btn-primary" disabled={state.busy || state.ok} onClick={submit}>
          {state.busy ? "Posting…" : state.ok ? "Posted ✓" : "Submit to Discord"}
        </button>
        <span className="small muted">Both managers agreed? This posts the trade, with a chart of who gets what and the score, in the league&apos;s #trade-proposals channel, where the admins vote on it.</span>
      </div>
      {state.msg && <p className={`notice ${state.ok ? "ok" : "error"}`} style={{ margin: "10px 0 0" }}>{state.msg}</p>}
      <details className="trade-detail">
        <summary>How the score works</summary>
        <p className="hint">
          OVR isn&apos;t the yardstick. Each player gets a <b>UR</b> (user rating, 1–99): his percentile among the league&apos;s players at his
          position on the traits that win user games, with speed, acceleration, agility, height and strength weighted far more than Madden does
          (about half the weight at skill positions). Value grows steeply with UR, then adjusts for position (QB, WR, CB and edge count most),
          age, dev trait, years of control and how his cap hit compares with what that value is worth. A team gets full value for a player
          who upgrades a starting spot, extra if that spot is a weak one, and about half for one who&apos;d sit behind better players. Losing a
          starter costs more when nobody good is behind him. Cap space gained counts a little; picks are valued by their spot in the draft (round and
          pick number). Each pick starts at its team&apos;s spot in the next draft order (final once the playoffs are over, projected
          from records before that; later drafts are estimates), and you can type the real number if it&apos;s different. Grades compare what each team gets with what it gives, so both teams can come out ahead.
        </p>
      </details>
    </section>
  );
}

function ScoreSide({ t }: { t: TeamScore }) {
  const row = (x: AssetScore, gets: boolean) => (
    <li key={`${gets ? "g" : "s"}${x.id}`}>
      <span className="ts-name"><b>{x.label}</b> <span className="muted small">{x.sub}</span>{x.note && <span className="small ts-note">{x.note}</span>}</span>
      <span className="num ts-worth">{gets ? "+" : "−"}{x.worth.toFixed(0)}</span>
    </li>
  );
  return (
    <div className="ts-side" style={{ borderTop: `3px solid ${t.team.primary}` }}>
      <h4>{t.team.name} <span className="muted small">net {t.net >= 0 ? "+" : ""}{t.net.toFixed(0)}</span></h4>
      <ul className="ts-list">
        <li className="ts-label small muted">Gets</li>
        {t.gets.map((x) => row(x, true))}
        {t.gets.length === 0 && <li className="small muted">Nothing</li>}
        <li className="ts-label small muted">Gives</li>
        {t.gives.map((x) => row(x, false))}
        {t.gives.length === 0 && <li className="small muted">Nothing</li>}
        {Math.abs(t.capPts) >= 0.5 && (
          <li><span className="ts-name"><b>Cap space</b> <span className="muted small">{money(t.capNow.change, { sign: true })} this season</span></span><span className="num ts-worth">{t.capPts >= 0 ? "+" : "−"}{Math.abs(t.capPts).toFixed(0)}</span></li>
        )}
      </ul>
      {t.needs.length > 0 && (
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Starters: {t.needs.map((n) => `${GROUP_NAME[n.g] || n.g} ${n.before} → ${n.after}`).join(" · ")} (avg UR)
        </p>
      )}
    </div>
  );
}

