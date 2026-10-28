"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { calculateOffer, MAX_BONUS_PRORATION_YEARS } from "@/lib/league/cap";
import { money, onColor } from "@/lib/league/format";

export type ToolPlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; dev: number; ps: boolean;
  c: [length: number, yearsLeft: number, salary: number, bonus: number, capHit: number];
  h: number[];     // cap hit by year from this season, current deal
  real: boolean;   // projected from his real NFL contract
};
export type ToolTeam = { id: number; abbr: string; name: string; primary: string; committed: number[]; cap: number[] };

const DEV = ["Normal", "Star", "Superstar", "X-Factor"];
const contractOf = (p: ToolPlayer) => ({ length: p.c[0], yearsLeft: p.c[1], salary: p.c[2], bonus: p.c[3], capHit: p.c[4] });

export function ContractTool({ slug, year, years, players, teams, initialPlayer }: {
  slug: string; year: number; years: number[]; players: ToolPlayer[]; teams: ToolTeam[]; initialPlayer: number | null;
}) {
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [selected, setSelected] = useState<ToolPlayer | null>(() => players.find((p) => p.id === initialPlayer) || null);
  const [query, setQuery] = useState(selected?.n || "");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return players.filter((p) => p.n.toLowerCase().includes(q)).sort((a, b) => b.ovr - a.ovr).slice(0, 12);
  }, [query, players]);

  function choose(p: ToolPlayer) {
    setSelected(p);
    setQuery(p.n);
    setOpen(false);
    window.history.replaceState(null, "", `/l/${slug}/contracts?player=${p.id}`);
  }

  return (
    <>
      <div className="panel search-panel">
        <label htmlFor="player-search">Find a player</label>
        <div className="combo">
          <input id="player-search" type="search" autoComplete="off" placeholder="Start typing a name"
            role="combobox" aria-expanded={open && matches.length > 0} aria-controls="player-results"
            value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); choose(matches[0]); } }} />
          {open && query.trim().length >= 2 && (
            <ul id="player-results" role="listbox" className="combo-list">
              {matches.length === 0 && <li className="muted combo-empty">No players match &quot;{query}&quot;.</li>}
              {matches.map((p) => {
                const t = teamById.get(p.t);
                return (
                  <li key={p.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                    <span>{p.n}</span>
                    <span className="muted small">{p.pos}, {p.ovr} OVR, {t ? t.abbr : "Free agent"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {selected ? <Detail key={selected.id} slug={slug} p={selected} year={year} years={years} players={players} teams={teams} teamById={teamById} />
        : <p className="muted">Search for anyone in the league, including free agents.</p>}
    </>
  );
}

function Detail({ slug, p, year, years, players, teams, teamById }: {
  slug: string; p: ToolPlayer; year: number; years: number[]; players: ToolPlayer[]; teams: ToolTeam[]; teamById: Map<number, ToolTeam>;
}) {
  const c = contractOf(p);
  const team = teamById.get(p.t);
  const currentYears = p.h.map((_, i) => year + i);
  const current: Record<number, number> = Object.fromEntries(p.h.map((v, i) => [year + i, v]));
  // Timing rule: a new deal starts the year after the current one's last year.
  // A free agent signing now counts this season.
  const startYear = c.yearsLeft > 0 ? year + c.yearsLeft : p.t ? year + 1 : year;

  const [length, setLength] = useState(String(Math.min(7, Math.max(1, c.length || 3))));
  const [salary, setSalary] = useState(((c.length ? c.salary / c.length : 1_000_000) / 1e6).toFixed(1));
  const [bonus, setBonus] = useState((c.bonus / 1e6).toFixed(1));
  const [gtd, setGtd] = useState("0");
  const [voids, setVoids] = useState("0");
  const [teamId, setTeamId] = useState(p.t || teams[0]?.id || 0);

  const offer = calculateOffer({
    startYear, length: Number(length) || 1, yearlySalary: (Number(salary) || 0) * 1e6, totalBonus: (Number(bonus) || 0) * 1e6,
    guaranteedYears: Number(gtd) || 0, voidYears: Number(voids) || 0,
  });
  const effTeam = teamById.get(teamId);
  const comps = players
    .filter((x) => x.id !== p.id && x.pos === p.pos && x.c[0] > 0 && x.c[2] + x.c[3] > 0 && Math.abs(x.age - p.age) <= 3 && Math.abs(x.ovr - p.ovr) <= 5)
    .sort((a, b) => Math.abs(a.age - p.age) + Math.abs(a.ovr - p.ovr) - (Math.abs(b.age - p.age) + Math.abs(b.ovr - p.ovr)))
    .slice(0, 8);

  return (
    <div className="tool-grid">
      <div className="tool-main">
        <section className="panel">
          <div className="player-head">
            <div>
              <h3><Link href={`/l/${slug}/players/${p.id}`}>{p.n}</Link></h3>
              <div className="muted">{p.pos}, age {p.age}, {p.ovr} OVR, {DEV[p.dev]}{p.ps ? ", practice squad" : ""}</div>
            </div>
            {team ? <span className="team-pill" style={{ background: team.primary, color: onColor(team.primary) }}>{team.abbr}</span> : <span className="tag">Free agent</span>}
          </div>
          <div className="stat-tiles">
            <div className="tile"><div className="tile-label">Current deal</div><div className="tile-value">{money(c.salary + c.bonus)}</div><div className="tile-sub">{c.length} yrs, {c.yearsLeft} left</div></div>
            <div className="tile"><div className="tile-label">Per year</div><div className="tile-value">{money(c.length ? (c.salary + c.bonus) / c.length : 0)}</div></div>
            <div className="tile"><div className="tile-label">Signing bonus</div><div className="tile-value">{money(c.bonus)}</div></div>
            <div className="tile"><div className="tile-label">Cap hit {year}</div><div className="tile-value">{money(c.capHit)}</div></div>
          </div>
          {currentYears.length > 0 ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>{currentYears.map((y, i) => <th key={y} className="num">{y}{i > 0 && <span className="proj">proj.</span>}</th>)}</tr></thead>
                <tbody><tr>{currentYears.map((y, i) => <td key={y} className={`num ${i === 0 ? "strong" : ""}`}>{money(current[y])}</td>)}</tr></tbody>
              </table>
            </div>
          ) : <p className="muted">No contract on file.</p>}
          {p.real && currentYears.length > 1 && <p className="hint">Later years follow his real NFL contract, which Madden copied into the franchise.</p>}
        </section>

        <section className="panel">
          <h3>Build an offer <span className="muted small">starts {startYear}{c.yearsLeft > 1 ? `, after the ${c.yearsLeft} years left on his current deal` : ""}</span></h3>
          <div className="offer-grid">
            <Num label="Length (years)" value={length} set={setLength} min={1} max={7} step={1} />
            <Num label="Avg. salary per year ($M)" value={salary} set={setSalary} min={0} step={0.1} />
            <Num label="Signing bonus ($M)" value={bonus} set={setBonus} min={0} step={0.1} />
            <Num label="Guaranteed years" value={gtd} set={setGtd} min={0} max={Number(length) || 1} step={1} />
            <Num label="Void years" value={voids} set={setVoids} min={0} max={5} step={1} />
          </div>
          <div className="stat-tiles three">
            <div className="tile"><div className="tile-label">Total value</div><div className="tile-value">{money(offer.totalValue)}</div></div>
            <div className="tile"><div className="tile-label">Per year</div><div className="tile-value">{money(offer.apy)}</div></div>
            <div className="tile"><div className="tile-label">Bonus spread over</div><div className="tile-value">{offer.prorationYears} yrs</div><div className="tile-sub">max {MAX_BONUS_PRORATION_YEARS}</div></div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Year</th><th className="num">Salary</th><th className="num">Bonus</th><th className="num">Cap hit</th><th className="num">Dead if cut after</th></tr></thead>
              <tbody>
                {offer.rows.map((r) => (
                  <tr key={r.year}>
                    <td>{r.year}{r.isVoid && <span className="tag">Void</span>}</td>
                    <td className="num">{money(r.baseSalary)}</td>
                    <td className="num">{money(r.bonus)}</td>
                    <td className="num strong">{money(r.capHit)}</td>
                    <td className="num muted">{money(r.deadIfCutAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Salary rises by the same amount each year and the bonus is spread evenly over up to 5 years, the way Madden builds new deals. The raise size follows what Madden gave real extensions of the same length, so the exact split can differ a little from what Madden shows.</p>
        </section>

        <section className="panel">
          <div className="section-head">
            <h3>Effect on cap</h3>
            <label className="inline-select">
              <span className="sr-only">Team</span>
              <select value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          {effTeam && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Year</th><th className="num">Already committed</th><th className="num">This deal</th><th className="num">League cap</th><th className="num">Space after</th></tr></thead>
                <tbody>
                  {offer.rows.map((r) => {
                    const i = years.indexOf(r.year);
                    if (i < 0) return <tr key={r.year}><td>{r.year}</td><td colSpan={4} className="muted">Too far out to project.</td></tr>;
                    const after = effTeam.cap[i] - effTeam.committed[i] - r.capHit;
                    return (
                      <tr key={r.year}>
                        <td>{r.year}{i > 0 && <span className="proj">proj.</span>}</td>
                        <td className="num">{money(effTeam.committed[i])}</td>
                        <td className="num">+{money(r.capHit)}</td>
                        <td className="num muted">{money(effTeam.cap[i])}</td>
                        <td className={`num strong ${after < 0 ? "neg" : "pos"}`}>{money(after)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">{year} uses the team&apos;s real cap numbers. Later years add up current contracts against a league cap that grows $15M a year. Any leftover money from his old deal keeps counting on its own schedule; this deal adds on top.</p>
        </section>
      </div>

      <aside className="panel comps">
        <h3>Comparable contracts</h3>
        <p className="muted small">Other {p.pos}s within 3 years of age and 5 OVR. For reference, not a suggested price.</p>
        {comps.length === 0 ? <p className="muted">No close comps.</p> : (
          <ul>
            {comps.map((x) => {
              const t = teamById.get(x.t);
              const total = x.c[2] + x.c[3];
              return (
                <li key={x.id}>
                  <div className="comp-top"><Link href={`/l/${slug}/players/${x.id}`}>{x.n}</Link><span className="muted small">{t ? t.abbr : "FA"}</span></div>
                  <div className="muted small">Age {x.age}, {x.ovr} OVR</div>
                  <div className="small">{x.c[0]} yrs, {money(total)} ({money(total / x.c[0])}/yr)</div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Num({ label, value, set, min, max, step }: { label: string; value: string; set: (v: string) => void; min: number; max?: number; step: number }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" value={value} min={min} max={max} step={step} onChange={(e) => set(e.target.value)} />
    </label>
  );
}
